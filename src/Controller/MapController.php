<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use App\Service\VelibApiService;

final class MapController extends AbstractController
{
    #[Route('/carte', name: 'app_map')]
    public function index(Request $request, VelibApiService $velibApiService): Response
    {
        $selectedStation = $request->query->get('station');
        $stations = $velibApiService->getStations();

        return $this->render('map/index.html.twig', [
            'stations' => $stations,
            'selectedStation' => $selectedStation
        ]);
    }


}
