<?php

namespace App\Controller;

use App\Service\VelibApiService;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class MapLibreController extends AbstractController
{
    #[Route('/maplibre', name: 'app_maplibre')]
    public function index(VelibApiService $velibApiService): Response
    {
        $stations = $velibApiService->getStations();

        return $this->render('map_libre/index.html.twig', [
            'stations' => $stations,
        ]);
    }
}