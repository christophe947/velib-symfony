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
    public function index(Request $request, VelibApiService $velibApiService): Response
    {
        $stations = $velibApiService->getStations();

        return $this->render('station/index.html.twig', [
            'stations' => $stations
        ]);
    }
    
}

