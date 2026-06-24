<?php

namespace App\Controller;

use App\Service\VelibApiService;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\HttpFoundation\Request;

class StationController extends AbstractController
{
    #[Route('/stations', name: 'app_stations')]
    public function index(
        Request $request,
        VelibApiService $velibApiService
    ): Response
    {
        $selectedStation = $request->query->get('station');

        $stations = $velibApiService->getStations();


        usort($stations, function ($a, $b) {
            return strcmp(
                strtolower($a['name']),
                strtolower($b['name'])
            );
        });


        $page = max(1, $request->query->getInt('page', 1));

        $limit = 20;

        $totalStations = count($stations);

        $totalPages = ceil($totalStations / $limit);


        $stations = array_slice(
            $stations,
            ($page - 1) * $limit,
            $limit
        );


        return $this->render('station/index.html.twig', [
            'stations' => $stations,
            'selectedStation' => $selectedStation,
            'currentPage' => $page,
            'totalPages' => $totalPages
        ]);
    }
}